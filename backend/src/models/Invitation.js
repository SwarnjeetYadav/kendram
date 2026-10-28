import mongoose from 'mongoose'

const invitationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    invitedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectRole: {
      type: String,
      enum: ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'],
      default: 'MEMBER',
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

invitationSchema.index({ projectId: 1, invitedUserId: 1, status: 1 })

export default mongoose.model('Invitation', invitationSchema)
