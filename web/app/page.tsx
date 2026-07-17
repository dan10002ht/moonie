import { AnnouncementBar } from "@/components/landing/AnnouncementBar";
import { Collection } from "@/components/landing/Collection";
import { ContactSheet } from "@/components/landing/ContactSheet";
import { CorporateGifting } from "@/components/landing/CorporateGifting";
import { Craft } from "@/components/landing/Craft";
import { Flavors } from "@/components/landing/Flavors";
import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { StickyMobileCTA } from "@/components/landing/StickyMobileCTA";
import { Testimonials } from "@/components/landing/Testimonials";
import { TrustStrip } from "@/components/landing/TrustStrip";
import { getProducts } from "@/lib/api";

/**
 * Landing Mooni Cake — Server Component compose các section theo mockup
 * design/mooni-landing.html. Task 2: khung. Task 3: product & content sections
 * (Collection + Flavors đọc GET /products; Corporate/Craft/Testimonials tĩnh).
 */
// Render động mỗi request để card sản phẩm luôn phản ánh data hiện tại từ API
// (tránh prerender đóng băng trạng thái fallback khi build lúc API chưa chạy).
export const dynamic = "force-dynamic";

export default async function Home() {
  // Tên sản phẩm cho select "sản phẩm quan tâm" trong ContactSheet.
  // API lỗi/trống → select vẫn có "Tư vấn chung" (fallback trong ContactSheet).
  let productNames: string[] = [];
  try {
    productNames = (await getProducts()).map((p) => p.name);
  } catch {
    productNames = [];
  }

  return (
    <>
      {/* r-padbottom: chừa chỗ cho sticky CTA ở ≤720px */}
      <div className="bg-cream max-[720px]:pb-[88px]">
        <AnnouncementBar />
        <Header />

        <main>
          <Hero />
          <TrustStrip />

          <Collection />
          <CorporateGifting />
          <Craft />
          <Flavors />
          <Testimonials />

          <Footer />
        </main>
      </div>

      <StickyMobileCTA />

      {/* Bottom sheet liên hệ toàn cục — mở bởi mọi nút [data-open-contact] */}
      <ContactSheet products={productNames} />
    </>
  );
}
