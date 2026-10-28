import Icon from './Icon'

export default function StatCard({ item }) {
  return (
    <article className="stat-card">
      <div className={'stat-icon stat-icon-' + item.tone}>
        <Icon name={item.icon} size={18} />
      </div>
      <div className="stat-head">
        <span>{item.label}</span>
        <span className="stat-ellipsis">•••</span>
      </div>
      <strong className="stat-value">{item.value}</strong>
      <div className={'stat-change ' + (item.change.startsWith('+') ? 'stat-change-positive' : 'stat-change-neutral')}>
        {item.change}
      </div>
    </article>
  )
}
