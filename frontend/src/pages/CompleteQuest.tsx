import Icon from "../components/Icon";
import type { Request } from "../data/requests";
type Props = { selectedRequest: Request; onBack: () => void };
export default function CompleteQuest({selectedRequest, onBack}: Props) {
  return (
        <main className="grid min-h-[calc(100vh-64px)] place-items-center bg-[#F7F9F9] px-5 py-12">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-2 border-[#78D5D7] text-[#2081C3]">
              <Icon name="check" size={38} />
            </div>
            <h1 className="mt-7 text-3xl font-extrabold tracking-[-0.8px]">Quest Complete!</h1>
            <p className="mt-3 text-sm text-slate-500">
              {selectedRequest.title} · for {selectedRequest.poster}
            </p>
            <div className="mt-8 rounded-lg border border-[#BED8D4] bg-white p-7 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                You earned
              </p>
              <p className="mt-2 text-5xl font-extrabold tracking-[-1.5px] text-[#2081C3]">
                {selectedRequest.price}
              </p>
              <p className="mt-3 text-sm text-slate-500">Added to your SideQuest balance.</p>
            </div>
            <button className="mt-6 w-full rounded-md border border-[#2081C3] py-3.5 text-sm font-bold text-[#2081C3] hover:bg-[#63D2FF]/10">
              Leave a Review
            </button>
            <button
              onClick={onBack}
              className="mt-3 w-full rounded-md bg-[#2081C3] py-3.5 text-sm font-bold text-white hover:bg-[#176FA9]"
            >
              Back to Map
            </button>
          </div>
        </main>
  );
}
