export default function SectionHeader({ title, subtitle, action, onAction }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <button className="text-action" onClick={onAction}>{action} <span>→</span></button> : null}
    </div>
  )
}
