import Icon from './Icon'
import Avatar from './Avatar'
import Badge from './Badge'

export default function WorkloadCard({ members = [], onSuggest }) {
  return (
    <aside className="workload-card">
      <div className="workload-top">
        <div><span className="eyebrow">Smart assignment</span><h3>Team workload</h3></div>
        <span className="smart-chip"><Icon name="spark" size={13} /> Balanced</span>
      </div>
      <p className="workload-subtitle">Use current active tasks to keep work evenly distributed.</p>
      <div className="workload-list">
        {members.length ? members.map((member) => (
          <div className="workload-row" key={member.name}>
            <Avatar initials={member.initials} color={member.tone} size="sm" />
            <div className="workload-person"><strong>{member.name}</strong><span>{member.tasks} active tasks</span></div>
            <Badge color={member.tone}>{member.status}</Badge>
          </div>
        )) : (
          <div className="workload-empty">No team workload data yet.</div>
        )}
      </div>
      <button className="smart-button" type="button" onClick={onSuggest} disabled={!onSuggest}>
        <Icon name="spark" size={16} /> {members.length ? 'Suggest assignee' : 'Waiting for team'} <span>→</span>
      </button>
    </aside>
  )
}
