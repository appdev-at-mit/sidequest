import { useState } from "react";
import WalletPage from "./WalletPage";

type SettingsTab = "personalization" | "customization" | "payment";
const tabs: { id: SettingsTab; label: string }[] = [
  { id: "personalization", label: "Personalization" },
  { id: "customization", label: "Customization" },
  { id: "payment", label: "Payment" },
];

export default function SettingsPage({ initialTab = "personalization" }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  return <main className="min-h-[calc(100dvh-64px)] bg-[#F7F9F9] px-5 py-8 sm:px-8">
    <section className="mx-auto max-w-5xl">
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <nav aria-label="Settings sections" className="grid content-start gap-1 border-b border-[#BED8D4] pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
          {tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)} className={`w-full rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold transition sm:text-base ${tab === item.id ? "border-[#2081C3] bg-[#E5F1F3] text-[#08679e]" : "border-transparent text-slate-600 hover:bg-[#EAF3F2] hover:text-[#102A3A]"}`}>{item.label}</button>)}
        </nav>
        <div className="min-w-0">
        {tab === "payment" ? <WalletPage /> : <section className="rounded-xl border border-[#BED8D4] bg-white p-6">
          <h2 className="text-xl font-bold">{tab === "personalization" ? "Personalization" : "Customization"}</h2>
          <p className="mt-2 text-sm text-slate-600">{tab === "personalization" ? "Personal account preferences will be managed here." : "SideQuest appearance and display preferences will be managed here."}</p>
        </section>}
        </div>
      </div>
    </section>
  </main>;
}
