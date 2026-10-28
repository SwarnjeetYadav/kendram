import mongoose from 'mongoose'

const taskSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM', index: true },
    status: { type: String, enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'], default: 'TODO', index: true },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    labels: {
      type: [{ type: String, trim: true, minlength: 1, maxlength: 32 }],
      default: [],
      validate: {
        validator: (labels) => Array.isArray(labels) && labels.length <= 20 && new Set(labels.map((label) => label.toLowerCase())).size === labels.length,
        message: 'A task may have at most 20 unique labels',
      },
    },
    dueDate: { type: Date, default: null, index: true },
    estimateMinutes: { type: Number, min: 5, max: 43200, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Incremented on every successful update for optimistic concurrency control.
    version: { type: Number, min: 1, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

taskSchema.index({ projectId: 1, assigneeId: 1, status: 1, dueDate: 1 })
taskSchema.index({ projectId: 1, labels: 1 })
taskSchema.index({ projectId: 1, createdAt: -1 })

export default mongoose.model('Task', taskSchema)
