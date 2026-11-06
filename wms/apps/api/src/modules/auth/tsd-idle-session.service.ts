import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from './access-token.service';
import type { TokenPayload } from './auth.types';

const IDLE_MS = 15 * 60_000;
const denied = () => new UnauthorizedException({code:'TSD_SESSION_EXPIRED',message:'Вход ТСД завершён. Войдите тем же сотрудником: неподтверждённые сканы сохранены.'});

// FIX: stable device tokens use a durable sliding deadline; background requests cannot extend it.
export class TsdIdleSessionService {
  constructor(private readonly db: PrismaService, private readonly tokens: AccessTokenService) {}
  async start<T extends {accessToken:string;user:{id:string};device:{id:string;code:string}}>(login:T) {
    if (process.env.WMS_TSD_IDLE_SESSION_ENABLED !== 'true') return login;
    const accessToken=this.tokens.sign(login.user.id,{deviceId:login.device.id,deviceCode:login.device.code,tsdIdleSessionId:randomUUID()});
    await this.db.userSession.create({data:{userId:login.user.id,accessTokenId:this.tokens.fingerprint(accessToken),
      appName:'LOGOFF ТСД · 15 минут бездействия',lastSeenAt:new Date(),expiresAt:new Date(Date.now()+IDLE_MS)}});
    return {...login,accessToken,idleTimeoutSeconds:900};
  }
  async assertActive(token:string,payload:TokenPayload) {
    if(process.env.WMS_TSD_IDLE_SESSION_ENABLED!=='true'||!payload.tsdIdleSessionId||!payload.deviceId||!payload.deviceCode) throw denied();
    const [session,device]=await Promise.all([
      this.db.userSession.findUnique({where:{accessTokenId:this.tokens.fingerprint(token)}}),
      this.db.tsdDevice.findUnique({where:{id:payload.deviceId},select:{userId:true,status:true,code:true}}),
    ]);
    if(!session||session.userId!==payload.sub||!session.expiresAt||session.expiresAt.getTime()<=Date.now()
      ||device?.status!=='ACTIVE'||device.userId!==payload.sub||device.code!==payload.deviceCode) throw denied();
    return session;
  }
  async activity(token:string,body:{activityAgeMs?:unknown}) {
    const age=body?.activityAgeMs;
    if(typeof age!=='number'||!Number.isInteger(age)||age<0||age>=IDLE_MS) throw new BadRequestException('Некорректное время действия ТСД.');
    const payload=this.tokens.verify(token,true);
    await this.assertActive(token,payload);
    const now=new Date(), expiresAt=new Date(now.getTime()+IDLE_MS-age);
    // FIX: CAS cannot revive a concurrently expired/revoked session; late inputs cannot shorten it.
    const result=await this.db.userSession.updateMany({where:{accessTokenId:this.tokens.fingerprint(token),userId:payload.sub,
      expiresAt:{gt:now,lt:expiresAt}},data:{expiresAt,lastSeenAt:new Date(now.getTime()-age)}});
    if(!result.count) {
      const current=await this.assertActive(token,payload);
      if(current.expiresAt!.getTime()<expiresAt.getTime()) throw denied();
    }
    return {accepted:true,idleTimeoutSeconds:900};
  }
}
