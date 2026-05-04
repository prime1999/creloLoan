import Image from "next/image";
// image-imports
import hero from "@/public/images/Hero.png";
// icont-imports
// components-imports
import Navbar from "@/components/Navbar";
import LoansSection from "@/components/LoansSection";

const page = () => {
  return (
    <div className="min-h-screen bg-black text-white font-poppins selection:bg-gold/30">
      {/* --- NAVBAR --- */}
      <Navbar />
      <main className="w-11/12 sm:w-10/12 mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12">
        {/* --- HERO SECTION --- */}
        <section className="flex flex-col md:flex-row items-center md:items-start justify-between gap-8 md:gap-10 mb-12 sm:mb-16">
          <div className="w-full md:max-w-xl text-center md:text-left">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold font-fjalla leading-tight md:leading-[1.1] mb-4 sm:mb-6">
              Borrow Smarter
              <br />
              and Faster on
              <br />
              <span className="text-gold font-fjalla">CreloLoan</span>
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-none md:max-w-md mt-2 md:-mt-4 mb-8 md:mb-12">
              Borrow USDC with transparent deadlines and low friction. Let your
              income speak for you. No more worrying about interest rates or
              hidden fees. Just simple, predictable borrowing based on your
              earnings. Experience the future of finance with{" "}
              <span className="font-semibold text-zinc-300">CreloLoan</span>.
            </p>
            <div className="flex items-center justify-center md:justify-start gap-4 mb-4">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                Ξ
              </div>
              <h2 className="text-sm sm:text-base font-bold">
                Open USDC Lending Vault
              </h2>
            </div>
          </div>

          <div className="relative w-full md:w-1/2 max-w-140 aspect-5/4 sm:aspect-5/3">
            <Image
              src={hero}
              alt="Hero"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover rounded-2xl"
            />
          </div>
        </section>

        {/* --- LOANS SECTION --- */}
        <LoansSection />
      </main>
    </div>
  );
};

export default page;
