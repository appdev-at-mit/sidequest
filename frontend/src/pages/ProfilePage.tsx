
import { useState, type ChangeEvent, type FormEvent } from "react";
import "./ProfilePage.css";

type Profile = {
  name: string;
  bio: string;
  avatar: string | null;
};


type Quest = {
  id: number;
  title: string;
  date: string;
  price: number;
  status: string;
};

const questHistory: Record<"Posted" | "Completed", Quest[]> = {
  Posted: [
    {
      id: 1,
      title: "Photograph furniture listing",
      date: "May 20, 2025",
      price: 35,
      status: "Open",
    },
    {
      id: 2,
      title: "Pick up library hold",
      date: "May 19, 2025",
      price: 22,
      status: "In Progress",
    },
  ],

  Completed: [
    {
      id: 3,
      title: "Deliver lab materials",
      date: "May 18, 2025",
      price: 45,
      status: "Completed",
    },
    {
      id: 4,
      title: "Assemble a bookshelf",
      date: "May 12, 2025",
      price: 65,
      status: "Completed",
    },
    {
      id: 5,
      title: "Review Python assignment",
      date: "May 7, 2025",
      price: 38,
      status: "Completed",
    },
  ],
};


export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"Posted" | "Completed">("Completed");


  const [profile, setProfile] = useState<Profile>({
  name: "Jordan Davis",
  bio: "MIT student happy to help with campus quests.",
  avatar: null,
});

  const [draftProfile, setDraftProfile] = useState<Profile>(profile);

  const [isEditing, setIsEditing] = useState(false);


function startEditing() {
  setDraftProfile({ ...profile });
  setIsEditing(true);
}

function cancelEditing() {
  setDraftProfile({ ...profile });
  setIsEditing(false);
}

function saveProfile(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!draftProfile.name.trim()) return;

  setProfile({
    ...draftProfile,
    name: draftProfile.name.trim(),
  });

  setIsEditing(false);
}

function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];

  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();

  reader.onload = () => {
    const result = reader.result;

    if (typeof result === "string") {
      setDraftProfile((previous) => ({
        ...previous,
        avatar: result,
      }));
    }
  };

  reader.readAsDataURL(file);
}

const initials = profile.name
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((word) => word[0]?.toUpperCase() ?? "")
  .join("");


  return (
    <main className="profile-page">
      <div className="profile-container">
        <h1>My Profile</h1>

        {/* Profile Information */}

<section className="profile-header">

  <div className="profile-avatar">
    {profile.avatar ? (
      <img src={profile.avatar} alt="Profile avatar" />
    ) : (
      initials
    )}
  </div>

  <div className="profile-info">
    <h2>{profile.name}</h2>
    <p>jordan.davis@mit.edu</p>

    <span className="profile-rating">
      ⭐ 4.9 (42 reviews)
    </span>

    <p className="profile-bio">{profile.bio}</p>
  </div>

  <button
    type="button"
    className="profile-edit-button"
    onClick={startEditing}
    disabled={isEditing}
  >
    Edit Profile
  </button>

</section>


{isEditing && (
  <form className="profile-edit-form" onSubmit={saveProfile}>
    <h2>Edit Profile</h2>

    <label htmlFor="profile-name">Display Name</label>
    <input
      id="profile-name"
      type="text"
      required
      value={draftProfile.name}
      onChange={(event) =>
        setDraftProfile({
          ...draftProfile,
          name: event.target.value,
        })
      }
    />

    <label htmlFor="profile-bio">Bio</label>
    <textarea
      id="profile-bio"
      rows={3}
      value={draftProfile.bio}
      onChange={(event) =>
        setDraftProfile({
          ...draftProfile,
          bio: event.target.value,
        })
      }
    />

    <label htmlFor="profile-picture">Profile Picture</label>
    <input
      id="profile-picture"
      type="file"
      accept="image/*"
      onChange={handleAvatarChange}
    />

    <div className="profile-form-actions">
      <button type="submit" className="profile-save-button">
        Save Changes
      </button>

      <button
        type="button"
        className="profile-cancel-button"
        onClick={cancelEditing}
      >
        Cancel
      </button>
    </div>
  </form>
)}

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


<div className="quest-list">
  {questHistory[activeTab].map((quest) => (
    <div key={quest.id} className="quest-card">
      <div className="quest-details">
        <h3>{quest.title}</h3>
        <p>{quest.date}</p>
      </div>

      <div className="quest-meta">
        <span className="quest-price">
          ${quest.price}
        </span>
        <span className="quest-status">
          {quest.status}
        </span>
      </div>
    </div>
  ))}
</div>

        </section>
      </div>
    </main>
  );
}
