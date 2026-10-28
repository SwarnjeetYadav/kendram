import mongoose from 'mongoose'

const commentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
)

export default mongoose.model('Comment', commentSchema)
