import Icon from "./Icon";
export default function Logo() {
  return (
    <span className="flex items-center gap-1.5" aria-label="Sidequest">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2081C3] text-[#F7F9F9]">
        <Icon name="bolt" size={18} />
      </span>
      <span className="text-[18px] font-black tracking-[-0.8px] text-[#102A3A]">sidequest</span>
    </span>
  );
}
