import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DATE_PATTERN } from '@kite/shared';
import { Envelope } from '../interceptors/response.interceptor';

export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 25;
}

export class DateRangeQuery {
  @ApiPropertyOptional({ example: '2027-01-14', description: 'IST date, inclusive' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2027-01-15', description: 'IST date, inclusive' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class PagedDateRangeQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_PATTERN) to?: string;
}

export function paged<T>(data: T[], total: number, q: { page: number; pageSize: number }): Envelope<T[]> {
  return new Envelope(data, { page: q.page, pageSize: q.pageSize, total });
}

export function offset(q: { page: number; pageSize: number }): number {
  return (q.page - 1) * q.pageSize;
}
