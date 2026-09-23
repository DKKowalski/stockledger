import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsIn(['warehouse', 'shop'])
  type!: 'warehouse' | 'shop';
}
