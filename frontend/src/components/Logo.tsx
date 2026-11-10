import Icon from "./Icon";
export default function Logo() {
  return (
    <span className="flex items-center gap-2" aria-label="Sidequest">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#2081C3] text-[#F7F9F9]">
        <Icon name="bolt" size={20} />
      </span>
      <span className="text-[21px] font-black tracking-[-0.8px] text-[#102A3A]">sidequest</span>
    </span>
  );
}
