import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: true },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    displayName: { type: String, trim: true, maxlength: 50, default: '' },
    avatarUrl: { type: String, trim: true, maxlength: 2048, default: '' },
    bio: { type: String, trim: true, maxlength: 240, default: '' },
    location: { type: String, trim: true, maxlength: 80, default: '' },
    timezone: { type: String, trim: true, maxlength: 80, default: 'Asia/Kolkata' },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['ADMINISTRATOR', 'PROJECT_MANAGER', 'TEAM_MEMBER'],
      default: 'TEAM_MEMBER',
    },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    preferences: {
      notifications: {
        taskAssignment: { type: Boolean, default: true },
        projectInvitation: { type: Boolean, default: true },
        chatMention: { type: Boolean, default: true },
        dependencyUnblocked: { type: Boolean, default: true },
        teamUpdates: { type: Boolean, default: true },
      },
      display: {
        compactMode: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true },
)

export default mongoose.model('User', userSchema)
