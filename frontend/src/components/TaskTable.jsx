import Avatar from './Avatar'
import Badge from './Badge'

const priorityColor = { High: 'rose', Medium: 'amber', Low: 'blue', Critical: 'rose' }
const statusColor = { 'In Progress': 'violet', Review: 'amber', Todo: 'neutral', Blocked: 'rose', Completed: 'green' }
const avatarColor = { AK: 'violet', PS: 'blue', RM: 'green', NS: 'amber', VK: 'rose' }

export default function TaskTable({ tasks = [], onSelectTask }) {
  const openTask = (task) => onSelectTask?.(task)

  if (!tasks.length) {
    return <div className="empty-task-table">No matching tasks. Try changing the filters or create a new task.</div>
  }

  return (
    <div className="table-wrap">
      <table className="task-table">
        <thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.apiId || task.id}
              className={onSelectTask ? 'task-row-clickable' : ''}
              onClick={() => openTask(task)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && onSelectTask) {
                  event.preventDefault()
                  openTask(task)
                }
              }}
              tabIndex={onSelectTask ? 0 : undefined}
            >
              <td><div className="task-title-cell"><span className="task-check" /><div><strong>{task.title}</strong><span>{task.id} · {task.project}</span></div></div></td>
              <td><div className="assignee-cell"><Avatar initials={(task.assigneeName || task.assignee || 'TF').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()} color={avatarColor[task.assignee] || 'neutral'} size="sm" /><span>{task.assigneeName || task.assignee || 'Unassigned'}</span></div></td>
              <td><Badge color={priorityColor[task.priority] || 'neutral'}>{task.priority}</Badge></td>
              <td><Badge color={statusColor[task.status] || 'neutral'}>{task.status}</Badge></td>
              <td><span className={task.due === 'Today' ? 'due-today' : ''}>{task.due}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
