import { AnnouncementBar } from "@/components/landing/AnnouncementBar";
import { Collection } from "@/components/landing/Collection";
import { CorporateGifting } from "@/components/landing/CorporateGifting";
import { Craft } from "@/components/landing/Craft";
import { Flavors } from "@/components/landing/Flavors";
import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { StickyMobileCTA } from "@/components/landing/StickyMobileCTA";
import { Testimonials } from "@/components/landing/Testimonials";
import { TrustStrip } from "@/components/landing/TrustStrip";

/**
 * Landing Mooni Cake — Server Component compose các section theo mockup
 * design/mooni-landing.html. Task 2: khung. Task 3: product & content sections
 * (Collection + Flavors đọc GET /products; Corporate/Craft/Testimonials tĩnh).
 */
// Render động mỗi request để card sản phẩm luôn phản ánh data hiện tại từ API
// (tránh prerender đóng băng trạng thái fallback khi build lúc API chưa chạy).
export const dynamic = "force-dynamic";

export default function Home() {
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

          {/* TODO(Task 4): Contact section + lead form */}

          <Footer />
        </main>
      </div>

      <StickyMobileCTA />

      {/* TODO(Task 4): ContactSheet — bottom sheet liên hệ toàn cục */}
    </>
  );
}
