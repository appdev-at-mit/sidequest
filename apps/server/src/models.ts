import mongoose, { Schema } from "mongoose";
import { categories } from "./config.js";
const ref = { type: Schema.Types.ObjectId, ref: "User" };
const integer = (v: number) => Number.isSafeInteger(v);
const point = new Schema(
  {
    type: { type: String, enum: ["Point"], required: true, default: "Point" },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) =>
          v.length === 2 &&
          Number.isFinite(v[0]) &&
          Number.isFinite(v[1]) &&
          Math.abs(v[0]) <= 180 &&
          Math.abs(v[1]) <= 90,
        message:
          "Coordinates must be [longitude, latitude] within valid ranges",
      },
    },
    label: { type: String, required: true, maxlength: 120 },
  },
  { _id: false },
);
const userSchema = new Schema(
  {
    kerberosId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z][a-z0-9_-]{1,30}$/,
    },
    email: { type: String, required: true },
    displayName: { type: String, required: true, maxlength: 80 },
    avatarUrl: String,
    venmoUsername: { type: String, maxlength: 30 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    strikeCount: { type: Number, default: 0 },
    accountStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BANNED"],
      default: "ACTIVE",
    },
    blockedUserIds: [ref],
    role: { type: String, enum: ["STUDENT", "MODERATOR"], default: "STUDENT" },
    // Private serialization lock; incremented inside creation/review/moderation transactions.
    revision: { type: Number, default: 0 },
    questCreationTimes: { type: [Schema.Types.Date], default: [] },
    termsVersion: String,
    termsAcceptedAt: Date,
    fictional: { type: Boolean, default: false },
  },
  { timestamps: true },
);
const questSchema = new Schema(
  {
    requesterId: { ...ref, required: true },
    performerId: { ...ref, default: null },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 2000,
    },
    instructions: { type: String, maxlength: 1000 },
    category: { type: String, required: true, enum: categories },
    payCents: {
      type: Number,
      required: true,
      min: 1,
      max: 100000,
      validate: integer,
    },
    startLocation: { type: point, required: true },
    endLocation: point,
    deadline: {
      type: Date,
      required: true,
      validate: {
        validator: function (this: any, v: Date) {
          const start = this.createdAt || new Date();
          return v > start && v.getTime() - start.getTime() <= 86400000;
        },
        message: "Deadline must be within 24 hours of creation",
      },
    },
    status: {
      type: String,
      enum: [
        "OPEN",
        "ACCEPTED",
        "COMPLETED",
        "CANCELED",
        "EXPIRED",
        "DISPUTED",
      ],
      default: "OPEN",
    },
    acceptedAt: Date,
    workSubmittedAt: Date,
    completedAt: Date,
    canceledAt: Date,
    canceledBy: ref,
    cancellationStage: {
      type: String,
      enum: ["BEFORE_ACCEPTANCE", "AFTER_ACCEPTANCE"],
    },
    disputeReason: String,
    fictional: { type: Boolean, default: false },
  },
  { timestamps: true },
);
questSchema.index({ startLocation: "2dsphere" });
questSchema.index({ status: 1, deadline: 1 });
questSchema.index({ requesterId: 1, createdAt: -1 });
questSchema.index({ performerId: 1 });
const messageSchema = new Schema({
  questId: { type: Schema.Types.ObjectId, ref: "Quest", required: true },
  senderId: { ...ref, required: true },
  content: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 2000,
  },
  createdAt: { type: Date, default: Date.now },
  readAt: Date,
});
messageSchema.index({ questId: 1, createdAt: 1 });
const reviewSchema = new Schema({
  questId: { type: Schema.Types.ObjectId, ref: "Quest", required: true },
  reviewerId: { ...ref, required: true },
  revieweeId: { ...ref, required: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: integer },
  comment: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});
reviewSchema.index({ questId: 1, reviewerId: 1 }, { unique: true });
const reportSchema = new Schema({
  reporterId: { ...ref, required: true },
  reportedUserId: ref,
  questId: { type: Schema.Types.ObjectId, ref: "Quest" },
  messageId: { type: Schema.Types.ObjectId, ref: "Message" },
  reason: { type: String, required: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 2000 },
  status: {
    type: String,
    enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"],
    default: "OPEN",
  },
  resolution: String,
  resolvedBy: ref,
  createdAt: { type: Date, default: Date.now },
  resolvedAt: Date,
});
reportSchema.index({ status: 1, createdAt: -1 });
const strikeSchema = new Schema({
  userId: { ...ref, required: true },
  relatedReportId: {
    type: Schema.Types.ObjectId,
    ref: "Report",
    required: true,
  },
  reason: { type: String, required: true },
  issuedBy: { ...ref, required: true },
  createdAt: { type: Date, default: Date.now },
  revokedAt: Date,
  revokedBy: ref,
});
strikeSchema.index({ userId: 1, revokedAt: 1 });
const notificationSchema = new Schema({
  userId: { ...ref, required: true },
  questId: { type: Schema.Types.ObjectId, ref: "Quest" },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
notificationSchema.index({ userId: 1, createdAt: -1 });
const termsSchema = new Schema({
  userId: { ...ref, required: true },
  version: { type: String, required: true },
  acceptedAt: { type: Date, default: Date.now },
});
termsSchema.index({ userId: 1, version: 1 }, { unique: true });
export const User = mongoose.model("User", userSchema);
export const Quest = mongoose.model("Quest", questSchema);
export const Message = mongoose.model("Message", messageSchema);
export const Review = mongoose.model("Review", reviewSchema);
export const Report = mongoose.model("Report", reportSchema);
export const Strike = mongoose.model("Strike", strikeSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
export const TermsAcceptance = mongoose.model("TermsAcceptance", termsSchema);
export const models: mongoose.Model<any>[] = [
  User,
  Quest,
  Message,
  Review,
  Report,
  Strike,
  Notification,
  TermsAcceptance,
];
