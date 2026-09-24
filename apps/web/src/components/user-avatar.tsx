type UserAvatarProps = {
  name: string;
  size?: 'compact' | 'large';
};

export function UserAvatar({ name, size = 'compact' }: UserAvatarProps) {
  const initials = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'SL';

  return <span aria-hidden="true" className={`user-avatar ${size}`}>
    <svg className="user-avatar-rim" viewBox="0 0 44 44">
      <circle className="user-avatar-track" cx="22" cy="22" r="19.5" />
      <circle className="user-avatar-olive-arc" cx="22" cy="22" r="19.5" pathLength="100" />
      <circle className="user-avatar-sand-arc" cx="22" cy="22" r="19.5" pathLength="100" />
    </svg>
    <span className="user-avatar-core">{initials}</span>
  </span>;
}
