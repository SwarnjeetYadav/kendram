export default function Avatar({ initials, color = 'violet', size = 'sm' }) {
  return <span className={'avatar avatar-' + size + ' avatar-' + color} aria-hidden="true">{initials}</span>
}
