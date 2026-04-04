export default function StoryboardVignette({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'radial-gradient(circle at center, rgba(0,0,0,0) 48%, rgba(0,0,0,0.18) 68%, rgba(0,0,0,0.42) 84%, rgba(0,0,0,0.7) 100%)',
      }}
    />
  );
}
