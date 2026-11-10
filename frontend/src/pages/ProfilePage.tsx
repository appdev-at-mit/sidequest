import { useState } from "react";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
export default function ProfilePage() {
  const [profileTab, setProfileTab] = useState<"Posted" | "Completed">("Completed");
  return (
        <main className="min-h-[calc(100vh-64px)] bg-[#F7F9F9] px-5 py-10 sm:px-8">
          <div className="mx-auto max-w-4xl">
            <section className="flex flex-col gap-5 border-b border-[#BED8D4] pb-8 sm:flex-row sm:items-center">
              <Avatar initials="JD" large />
              <div>
                <h1 className="text-2xl font-extrabold tracking-[-0.5px]">Jordan Davis</h1>
                <p className="mt-1 text-sm text-slate-500">jordan.davis@mit.edu</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                  <span className="text-[#2081C3]">
                    <Icon name="star" size={15} />
                  </span>
                  4.9 <span className="font-normal text-slate-400">(42 reviews)</span>
                </p>
              </div>
              <button className="rounded-md border border-[#BED8D4] px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-[#78D5D7] sm:ml-auto">
                Edit Profile
              </button>
            </section>

            <section className="grid grid-cols-3 border-b border-[#BED8D4] py-8">
              {[
                ["18", "Quests Completed"],
                ["$1,240", "Total Earned"],
                ["Sep 2024", "Member Since"],
              ].map(([value, label], index) => (
                <div
                  key={label}
                  className={`px-3 text-center ${index > 0 ? "border-l border-[#BED8D4]" : ""}`}
                >
                  <p className="text-xl font-extrabold sm:text-2xl">{value}</p>
                  <p className="mt-1 text-xs text-slate-500 sm:text-sm">{label}</p>
                </div>
              ))}
            </section>

            <section className="pt-8">
              <div className="flex gap-7 border-b border-[#BED8D4]">
                {(["Posted", "Completed"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setProfileTab(tab)}
                    className={`relative pb-3 text-sm font-bold ${
                      profileTab === tab
                        ? "text-[#2081C3] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[#2081C3]"
                        : "text-slate-500"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="divide-y divide-[#BED8D4]">
                {(profileTab === "Completed"
                  ? [
                      ["Deliver lab materials", "May 18, 2025", "Completed", "$45"],
                      ["Assemble a bookshelf", "May 12, 2025", "Completed", "$65"],
                      ["Review Python assignment", "May 7, 2025", "Completed", "$38"],
                    ]
                  : [
                      ["Photograph furniture listing", "Today", "Active", "$35"],
                      ["Pick up library hold", "May 20, 2025", "Pending", "$22"],
                    ]
                ).map(([title, date, status, payout]) => (
                  <article key={title} className="flex items-center gap-4 py-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold">{title}</h2>
                      <p className="mt-1 text-xs text-slate-500">{date}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                        status === "Completed"
                          ? "bg-[#78D5D7]/30 text-[#174F72]"
                          : status === "Active"
                            ? "bg-[#63D2FF]/30 text-[#174F72]"
                            : "border border-[#BED8D4] text-slate-500"
                      }`}
                    >
                      {status}
                    </span>
                    <span className="w-14 text-right font-extrabold text-[#2081C3]">{payout}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </main>
  );
}
