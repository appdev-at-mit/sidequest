export default function Avatar({ initials, large = false }: { initials: string; large?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[#BED8D4] font-bold text-[#174F72] ${
        large ? "h-20 w-20 text-xl" : "h-10 w-10 text-sm"
      }`}
    >
      {initials}
    </span>
  );
}
