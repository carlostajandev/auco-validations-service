import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Connection, ConnectionStates } from 'mongoose';

/** Para que Docker / un balanceador sepan si el servicio está sano. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    const mongoUp = this.connection.readyState === ConnectionStates.connected;
    if (!mongoUp) {
      throw new ServiceUnavailableException({ status: 'down', mongo: 'down' });
    }
    return { status: 'ok', mongo: 'up' };
  }
}
