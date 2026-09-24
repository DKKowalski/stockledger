import { Input } from '@base-ui/react/input';

export function InputControl({ className, ...props }: Input.Props) {
  return <Input className={['text-input', className].filter(Boolean).join(' ')} {...props} />;
}
