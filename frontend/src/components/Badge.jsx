export default function Badge({ children, color = 'neutral' }) {
  return <span className={'badge badge-' + color}>{children}</span>
}
