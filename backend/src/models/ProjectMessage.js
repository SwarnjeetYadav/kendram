import mongoose from 'mongoose'

const projectMessageSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    replyToId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectMessage', default: null },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reactions: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      emoji: { type: String, enum: ['👍', '❤️', '✅', '👀', '🚀'], required: true },
    }],
  },
  { timestamps: true },
)

projectMessageSchema.index({ projectId: 1, createdAt: -1 })

export default mongoose.model('ProjectMessage', projectMessageSchema)
