package httpx

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"

	"github.com/go-chi/httprate"
)

// ClientIPResolver xác định IP client THẬT khi API đứng sau reverse proxy
// (production: khách → Caddy → Next → Go). r.RemoteAddr khi đó là IP của proxy,
// không phải khách, nên rate limit per-IP (NFR-006, M1) sẽ bóp nhầm toàn site.
//
// Resolver chỉ tin X-Forwarded-For khi peer TCP (RemoteAddr) NẰM TRONG danh sách
// proxy tin cậy — chống kẻ tấn công tự bơm XFF để né/đầu độc rate limit.
type ClientIPResolver struct {
	// trusted là các dải IP/CIDR của proxy tin cậy. Rỗng = không tin proxy nào →
	// luôn dùng RemoteAddr (hành vi cũ, default an toàn cho dev).
	trusted []netip.Prefix
}

// NewClientIPResolver dựng resolver từ danh sách IP/CIDR proxy tin cậy (thường
// lấy từ cfg.TrustedProxies). Mỗi phần tử là một IP đơn ("10.0.0.5") hoặc CIDR
// ("10.0.0.0/8"). Phần tử rỗng bị bỏ qua; phần tử sai định dạng → error kèm ngữ
// cảnh (fail-fast lúc khởi động). proxies rỗng → resolver không tin proxy nào.
func NewClientIPResolver(proxies []string) (*ClientIPResolver, error) {
	prefixes := make([]netip.Prefix, 0, len(proxies))
	for _, raw := range proxies {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		prefix, err := parseProxyPrefix(entry)
		if err != nil {
			return nil, fmt.Errorf("parse trusted proxy %q: %w", entry, err)
		}
		prefixes = append(prefixes, prefix)
	}
	return &ClientIPResolver{trusted: prefixes}, nil
}

// parseProxyPrefix biến một entry proxy thành netip.Prefix. Có "/" → CIDR; không
// thì là IP đơn, quy về /32 (IPv4) hoặc /128 (IPv6).
func parseProxyPrefix(entry string) (netip.Prefix, error) {
	if strings.Contains(entry, "/") {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			return netip.Prefix{}, err
		}
		return prefix.Masked(), nil
	}
	addr, err := netip.ParseAddr(entry)
	if err != nil {
		return netip.Prefix{}, err
	}
	addr = addr.Unmap()
	return netip.PrefixFrom(addr, addr.BitLen()), nil
}

// ClientIP trả IP client thật, đã canonicalize (dùng làm khoá rate limit).
//
// Quy tắc (chống spoof header):
//   - trusted rỗng → luôn dùng RemoteAddr.
//   - RemoteAddr KHÔNG parse được hoặc KHÔNG trusted → BỎ QUA X-Forwarded-For,
//     dùng RemoteAddr.
//   - RemoteAddr trusted → duyệt XFF từ PHẢI sang TRÁI, bỏ các hop là trusted
//     proxy, lấy IP đầu tiên KHÔNG-trusted làm client. XFF rỗng/toàn trusted/có
//     entry hỏng → fallback RemoteAddr.
func (c *ClientIPResolver) ClientIP(r *http.Request) string {
	remoteIP := remoteAddrHost(r.RemoteAddr)

	if len(c.trusted) == 0 {
		return httprate.CanonicalizeIP(remoteIP)
	}

	peer, err := netip.ParseAddr(remoteIP)
	if err != nil || !c.isTrusted(peer) {
		return httprate.CanonicalizeIP(remoteIP)
	}

	if client := c.rightmostUntrusted(r.Header.Get("X-Forwarded-For")); client != "" {
		return httprate.CanonicalizeIP(client)
	}
	return httprate.CanonicalizeIP(remoteIP)
}

// RateLimitKey khớp chữ ký httprate.KeyFunc (func(*http.Request) (string, error)).
// Không bao giờ trả error — client IP luôn giải được (fallback RemoteAddr).
func (c *ClientIPResolver) RateLimitKey(r *http.Request) (string, error) {
	return c.ClientIP(r), nil
}

// rightmostUntrusted duyệt X-Forwarded-For từ phải sang trái, bỏ qua các hop là
// trusted proxy, trả IP KHÔNG-trusted đầu tiên (client thật do proxy trong cùng
// ghi). Entry rỗng bị bỏ qua; entry SAI định dạng → dừng và trả "" (fallback
// RemoteAddr, an toàn) vì proxy tin cậy luôn ghi IP hợp lệ.
func (c *ClientIPResolver) rightmostUntrusted(xff string) string {
	if xff == "" {
		return ""
	}
	hops := strings.Split(xff, ",")
	for i := len(hops) - 1; i >= 0; i-- {
		entry := strings.TrimSpace(hops[i])
		if entry == "" {
			continue
		}
		addr, err := netip.ParseAddr(entry)
		if err != nil {
			return ""
		}
		if c.isTrusted(addr) {
			continue
		}
		return addr.String()
	}
	return ""
}

// isTrusted cho biết addr có thuộc một dải proxy tin cậy không. Unmap IPv4-mapped
// IPv6 để so khớp đúng họ địa chỉ với prefix.
func (c *ClientIPResolver) isTrusted(addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, prefix := range c.trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// remoteAddrHost tách phần host (IP) khỏi "ip:port" của r.RemoteAddr; nếu không
// có port thì trả nguyên chuỗi.
func remoteAddrHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
