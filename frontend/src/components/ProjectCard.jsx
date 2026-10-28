import Avatar from './Avatar'
import Badge from './Badge'

export default function ProjectCard({ project, onOpen }) {
  const members = project.members || []
  const progress = Number(project.progress || 0)

  return (
    <article className="project-card">
      <div className="project-card-top">
        <div className={'project-badge project-badge-' + (project.tone || 'violet')}>{project.name.charAt(0)}</div>
        <button className="more-button" type="button" aria-label={'Open ' + project.name} onClick={() => onOpen?.(project)}>•••</button>
      </div>

      <div className="project-card-copy">
        <h3>{project.name}</h3>
        <p>{project.meta}</p>
      </div>

      <div className="project-progress-row">
        <span>Progress</span>
        <strong>{progress}%</strong>
      </div>
      <div className="progress-track">
        <span className={'progress-fill progress-' + (project.tone || 'violet')} style={{ width: progress + '%' }} />
      </div>

      <div className="project-footer">
        <div className="avatar-stack" aria-label="Project members">
          {members.length ? members.slice(0, 3).map((member, index) => (
            <Avatar
              key={member.id || index}
              initials={member.initials}
              color={member.tone || 'violet'}
              size="xs"
            />
          )) : (
            <Avatar initials="—" color="neutral" size="xs" />
          )}
          {members.length > 3 ? <Avatar initials={'+' + (members.length - 3)} color="neutral" size="xs" /> : null}
        </div>
        <div className="project-meta-right">
          <Badge color={progress >= 75 ? 'green' : progress >= 40 ? 'blue' : 'neutral'}>{project.due}</Badge>
          <span>{project.tasks}</span>
        </div>
      </div>

      {onOpen ? (
        <button className="project-open-button" type="button" onClick={() => onOpen(project)}>
          Open project <span>→</span>
        </button>
      ) : null}
    </article>
  )
}
