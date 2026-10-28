import Avatar from './Avatar'

export default function ActivityFeed({ items = [] }) {
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div className="activity-item" key={item.person + item.time}>
          <Avatar initials={item.initials} color={item.tone} size="sm" />
          <div className="activity-copy">
            <p><strong>{item.person}</strong> {item.action}</p>
            <span>{item.time}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
