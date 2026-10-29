
import { useState } from "react";
import "./ProfilePage.css";

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"Posted" | "Completed">("Completed");

  return (
    <main className="profile-page">
      <div className="profile-container">
        <h1>My Profile</h1>

        {/* Profile Information */}
        <section className="profile-header">
          <div className="profile-avatar">JD</div>

          <div className="profile-info">
            <h2>Jordan Davis</h2>
            <p>jordan.davis@mit.edu</p>
            <span className="profile-rating">
              ⭐ 4.9 (42 reviews)
            </span>
          </div>
        </section>

        {/* Profile Statistics */}
        <section className="profile-stats">
          <div>
            <h3>18</h3>
            <p>Quests Completed</p>
          </div>

          <div>
            <h3>$1,240</h3>
            <p>Total Earned</p>
          </div>

          <div>
            <h3>Sep 2024</h3>
            <p>Member Since</p>
          </div>
        </section>

        {/* Quest History */}
        <section className="profile-history">
          <h2>Quest History</h2>

          <div className="profile-tabs">
            <button
              type="button"
              className={activeTab === "Posted" ? "active" : ""}
              onClick={() => setActiveTab("Posted")}
            >
              Posted
            </button>

            <button
              type="button"
              className={activeTab === "Completed" ? "active" : ""}
              onClick={() => setActiveTab("Completed")}
            >
              Completed
            </button>
          </div>

          <p>Showing {activeTab} quests</p>
        </section>
      </div>
    </main>
  );
}
