//go:build tools

// Package tools pin version cho các công cụ dev-time (không vào binary sản phẩm).
// Build tag `tools` khiến file này chỉ được biên dịch khi có tag đó, nên import
// dưới đây chỉ để `go mod` giữ oapi-codegen trong go.mod/go.sum với version cố định.
package tools

import (
	_ "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen"
)
