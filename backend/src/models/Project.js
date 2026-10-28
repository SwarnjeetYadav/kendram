import mongoose from 'mongoose'

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'],
      default: 'PLANNING',
    },
  },
  { timestamps: true },
)

export default mongoose.model('Project', projectSchema)
