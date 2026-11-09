import { useId, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

// One titled region, shared by the "Banked in" summary and the profit split (Stock capital uses the same pieces).
export function BankingCard({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
  const titleId = useId();
  return <Card role="region" className={className} aria-labelledby={titleId}>
    <CardHeader>
      <CardTitle id={titleId}><h2 className="text-base font-semibold">{title}</h2></CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="grid gap-3">{children}</CardContent>
  </Card>;
}
