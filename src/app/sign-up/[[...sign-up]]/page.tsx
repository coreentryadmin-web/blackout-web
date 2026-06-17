import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="font-display text-5xl tracking-[6px] text-white">BLACKOUT</h1>
        <p className="text-[10px] tracking-[4px] text-text-muted uppercase mt-1">Trading</p>
      </div>
      <SignUp
        appearance={{
          variables: {
            colorBackground: "#0a0a0a",
            colorText: "#f0f0f0",
            colorInputBackground: "#111",
            colorInputText: "#f0f0f0",
            colorPrimary: "#ffffff",
            colorTextSecondary: "#888",
            borderRadius: "0px",
            fontFamily: "Inter, sans-serif",
          },
          elements: {
            card: "border border-surface-3 shadow-none",
            headerTitle: "font-display tracking-widest text-white",
            formButtonPrimary: "bg-white text-black hover:bg-white/90 uppercase tracking-widest text-xs font-bold rounded-none",
            formFieldInput: "border-surface-3 rounded-none bg-surface-2",
            footerActionLink: "text-text-secondary hover:text-white",
          },
        }}
      />
    </div>
  );
}
