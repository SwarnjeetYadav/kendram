import mongoose from 'mongoose'

const projectMemberSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectRole: {
      type: String,
      enum: ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'],
      default: 'MEMBER',
    },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

projectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true })

export default mongoose.model('ProjectMember', projectMemberSchema)
