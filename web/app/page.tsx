import { AnnouncementBar } from "@/components/landing/AnnouncementBar";
import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { StickyMobileCTA } from "@/components/landing/StickyMobileCTA";
import { TrustStrip } from "@/components/landing/TrustStrip";

/**
 * Landing Mooni Cake — Server Component compose các section theo mockup
 * design/mooni-landing.html. Task 2 (giai đoạn 3): khung — announcement,
 * header, hero, trust, footer, sticky CTA.
 */
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

          {/* TODO(Task 3): Collection · Corporate · Craft/Story · Flavors · Testimonials */}
          {/* TODO(Task 4): Contact section + lead form */}

          <Footer />
        </main>
      </div>

      <StickyMobileCTA />

      {/* TODO(Task 4): ContactSheet — bottom sheet liên hệ toàn cục */}
    </>
  );
}
