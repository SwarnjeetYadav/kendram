import { useState } from 'react'
import Icon from './Icon'

export default function CreateProjectModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState('')

  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Project name is required')
      return
    }

    setError('')
    try {
      await onCreate({
        name: cleanName,
        description: description.trim(),
        startDate: startDate || null,
        dueDate: dueDate || null,
        status: 'ACTIVE',
      })
      setName('')
      setDescription('')
      setStartDate('')
      setDueDate('')
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">Workspace setup</span><h2 id="create-project-title">Create a project</h2><p>Set up a focused space for your next initiative.</p></div>
          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close modal"><Icon name="close" size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="field"><span>Project name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Product launch" minLength="2" maxLength="120" required /></label>
          <label className="field"><span>Description</span><textarea className="project-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this project about?" rows="3" maxLength="4000" /></label>
          <div className="field-grid">
            <label className="field"><span>Start date</span><input type="date" value={startDate} max={dueDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span>Due date</span><input type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          {error ? <div className="login-error">{error}</div> : null}
          <div className="modal-actions"><button type="button" className="ghost-dark-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button primary-button-dark"><Icon name="plus" size={15} /> Create project</button></div>
        </form>
      </section>
    </div>
  )
}
