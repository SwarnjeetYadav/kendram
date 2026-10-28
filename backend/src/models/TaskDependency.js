import mongoose from 'mongoose'

const taskDependencySchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    predecessorTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    successorTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

taskDependencySchema.index({ projectId: 1, predecessorTaskId: 1, successorTaskId: 1 }, { unique: true })

export default mongoose.model('TaskDependency', taskDependencySchema)
