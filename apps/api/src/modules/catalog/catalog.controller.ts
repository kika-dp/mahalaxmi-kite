import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Permission } from '@kite/shared';
import { AuthContext, CurrentUser, Permissions, RawResponse, ReqMeta, RequestMeta } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { PageQuery } from '../../common/utils/pagination';
import { imageUploadOptions, saveImage } from '../../common/utils/uploads';
import { CategoriesService } from './categories.service';
import {
  BulkPriceDto,
  CategoryDto,
  CreateProductDto,
  ImportQuery,
  LookupQuery,
  ProductsQuery,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto';
import { ProductsService } from './products.service';

const viewCost = (u: AuthContext) => u.permissions.has(Permission.CATALOG_VIEW_COST);

@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  // ------------------------------------------------------------ categories
  @Get('categories')
  @ApiQuery({ name: 'includeInactive', required: false })
  @Permissions(Permission.CATALOG_READ)
  listCategories(@Query('includeInactive') includeInactive?: string) {
    return this.categories.list(includeInactive === 'true');
  }

  @Post('categories')
  @Permissions(Permission.CATALOG_WRITE)
  createCategory(@Body() dto: CategoryDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.categories.create(dto, u, meta);
  }

  @Patch('categories/:id')
  @Permissions(Permission.CATALOG_WRITE)
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.categories.update(id, dto, u, meta);
  }

  @Delete('categories/:id')
  @Permissions(Permission.CATALOG_WRITE)
  deleteCategory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.categories.remove(id, u, meta);
  }

  // -------------------------------------------------------------- products
  @Get('products')
  @Permissions(Permission.CATALOG_READ)
  list(@Query() q: ProductsQuery, @CurrentUser() u: AuthContext) {
    return this.products.list(q, viewCost(u));
  }

  @Get('products/pos-catalog')
  @RawResponse()
  @Permissions(Permission.CATALOG_READ)
  async posCatalog(@Req() req: Request, @Res() res: Response) {
    const { body, etag } = await this.products.posCatalog();
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ data: body });
  }

  @Get('products/lookup')
  @Permissions(Permission.CATALOG_READ)
  lookup(@Query() q: LookupQuery, @CurrentUser() u: AuthContext) {
    return this.products.lookup(q.code, viewCost(u));
  }

  @Get('products/export')
  @RawResponse()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  @Permissions(Permission.CATALOG_READ)
  exportCsv(@CurrentUser() u: AuthContext) {
    return this.products.exportCsv(viewCost(u));
  }

  @Post('products/import')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @Permissions(Permission.CATALOG_WRITE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  importCsv(@UploadedFile() file: Express.Multer.File, @Query() q: ImportQuery, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    if (!file?.buffer) throw Errors.validation('Upload a CSV file in the "file" field');
    return this.products.importCsv(file.buffer, !!q.dryRun, u, meta);
  }

  @Post('products/bulk-price')
  @HttpCode(200)
  @Permissions(Permission.CATALOG_WRITE)
  bulkPrice(@Body() dto: BulkPriceDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.products.bulkPrice(dto.items, u, meta);
  }

  @Get('products/:id')
  @Permissions(Permission.CATALOG_READ)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext) {
    return this.products.get(id, viewCost(u));
  }

  @Get('products/:id/sales')
  @Permissions(Permission.REPORTS_FINANCIAL)
  sales(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.products.salesHistory(id, q);
  }

  @Post('products')
  @Permissions(Permission.CATALOG_WRITE)
  create(@Body() dto: CreateProductDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.products.create(dto, u, meta);
  }

  @Patch('products/:id')
  @Permissions(Permission.CATALOG_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.products.update(id, dto, u, meta);
  }

  @Delete('products/:id')
  @Permissions(Permission.CATALOG_WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.products.remove(id, u, meta);
  }

  @Post('products/:id/image')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @Permissions(Permission.CATALOG_WRITE)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async image(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthContext) {
    return this.products.setImage(id, await saveImage(file), u);
  }
}
