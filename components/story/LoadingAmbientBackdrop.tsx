'use client';

export default function LoadingAmbientBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.2),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.22),_transparent_38%),radial-gradient(circle_at_left_center,_rgba(255,255,255,0.06),_transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.15)_0%,rgba(10,10,10,0.45)_55%,rgba(10,10,10,0.8)_100%)]" />
      <div className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8 bg-white/5 blur-3xl" />
      <div className="absolute left-[12%] top-[18%] h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute bottom-[14%] right-[10%] h-64 w-64 rounded-full bg-indigo-500/12 blur-3xl" />
    </div>
  );
}
