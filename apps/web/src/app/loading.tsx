export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading Court Watch AAU"
      className="min-h-dvh bg-[#071323] px-5 py-8 text-white"
    >
      <div className="mx-auto max-w-5xl animate-pulse">
        <div className="h-5 w-40 bg-white/10" />
        <div className="mt-5 h-12 w-72 max-w-full bg-white/15" />
        <div className="mt-8 h-16 w-full bg-white/10" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="h-52 bg-white/10" />
          <div className="h-52 bg-white/10" />
        </div>
      </div>
    </main>
  );
}
