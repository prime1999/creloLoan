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
      <main className="w-10/12 mx-auto px-8 pt-12">
        {/* --- HERO SECTION --- */}
        <section className="grid grid-cols-2 gap-6 items-center mb-16">
          <div>
            <h1 className="text-5xl font-bold font-fjalla leading-[1.1] mb-6">
              Borrow Smarter
              <br />
              and Faster on
              <br />
              <span className="text-gold font-fjalla">CreloLoan</span>
            </h1>
            <p className="text-zinc-400 text-xs leading-relaxed max-w-md -mt-4 mb-12">
              Borrow USDC with transparent deadlines and low friction. Let your
              income speak for you. No more worrying about interest rates or
              hidden fees. Just simple, predictable borrowing based on your
              earnings. Experience the future of finance with{" "}
              <span className="font-semibold text-zinc-300">CreloLoan</span>.
            </p>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                Ξ
              </div>
              <h2 className="text-md font-bold">Open USDC Lending Vault</h2>
            </div>
          </div>

          <div className="relative h-[300px] w-full">
            <Image
              src={hero}
              width={500}
              height={300}
              alt="Hero"
              className="object-cover"
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
