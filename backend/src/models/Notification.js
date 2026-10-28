import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true, maxlength: 500 },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export default mongoose.model('Notification', notificationSchema)
