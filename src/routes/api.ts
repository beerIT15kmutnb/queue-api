/// <reference path="../../typings.d.ts" />

import * as Knex from 'knex';
import * as fastify from 'fastify';
import * as moment from 'moment';

import { QueueModel } from '../models/queue';
import { TokenModel } from '../models/token';
import { ServicePointModel } from '../models/service_point';
import { PriorityModel } from '../models/priority';

const queueModel = new QueueModel();
const servicePointModel = new ServicePointModel();
const priorityModel = new PriorityModel();

import * as HttpStatus from 'http-status-codes';
const tokenModel = new TokenModel();

const router = (fastify, { }, next) => {

  var db: Knex = fastify.db;

  var padStart = function padStart(str, targetLength, padString = '0') {
    targetLength = targetLength >> 0;
    if (str.length >= targetLength) {
      return str;
    } else {
      targetLength = targetLength - str.length;
      if (targetLength > padString.length) {
        padString += padString.repeat(targetLength / padString.length);
      }
      return padString.slice(0, targetLength) + str;
    }
  };

  fastify.post('/register', async (req: fastify.Request, reply: fastify.Reply) => {
    const token = req.body.token;
    const hn = req.body.hn;
    const vn = req.body.vn;
    const localCode = req.body.clinicCode;
    const priorityId = req.body.priorityId;
    const dateServ = req.body.dateServ;
    const timeServ = req.body.timeServ;
    const hisQueue = req.body.hisQueue;
    const firstName = req.body.firstName;
    const lastName = req.body.lastName;
    const title = req.body.title;
    const birthDate = req.body.birthDate;
    const sex = req.body.sex;

    if (token) {
      if (hn && vn && localCode && dateServ && timeServ && firstName && lastName && birthDate) {
        try {
          const decoded = fastify.jwt.verify(token)
          // check token 
          const rsToken: any = await tokenModel.find(db, token);
          if (rsToken.length) {
            // get service point id from mapping
            const rsLocalCode: any = await servicePointModel.getServicePointIdFromLocalCode(db, localCode);
            const servicePointId = rsLocalCode[0].service_point_id;

            if (servicePointId) {

              // get prefix
              const rsPriorityPrefix: any = await priorityModel.getPrefix(db, priorityId);
              const prefixPriority: any = rsPriorityPrefix[0].priority_prefix || 'T';
              const rsPointPrefix: any = await servicePointModel.getPrefix(db, servicePointId);
              const prefixPoint: any = rsPointPrefix[0].prefix || 'T';

              const rsDup: any = await queueModel.checkDuplicatedQueue(db, hn, vn, servicePointId);
              if (rsDup[0].total > 0) {
                reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ข้อมูลการรับบริการซ้ำ' })
              } else {
                await queueModel.savePatient(db, hn, title, firstName, lastName, birthDate, sex);
                var queueNumber = 0;
                var queueInterview = 0;

                var rs1 = await queueModel.checkServicePointQueueNumber(db, servicePointId, dateServ);
                var rs2 = await queueModel.checkServicePointQueueNumber(db, 999, dateServ);

                // queue number
                if (rs1.length) {
                  queueNumber = rs1[0]['current_queue'] + 1;
                  await queueModel.updateServicePointQueueNumber(db, servicePointId, dateServ);
                } else {
                  queueNumber = 1;
                  await queueModel.createServicePointQueueNumber(db, servicePointId, dateServ);
                }

                // queue interview
                if (rs2.length) {
                  queueInterview = rs2[0]['current_queue'] + 1;
                  await queueModel.updateServicePointQueueNumber(db, 999, dateServ);
                } else {
                  queueInterview = 1;
                  await queueModel.createServicePointQueueNumber(db, 999, dateServ);
                }

                const _queueRunning = queueNumber;
                const queueDigit = +process.env.QUEUE_DIGIT || 3;
                // const _queueNumber = padStart(queueNumber.toString(), queueDigit, '0');

                var _queueNumber = null;

                if (process.env.ZERO_PADDING === 'Y') {
                  _queueNumber = padStart(queueNumber.toString(), queueDigit, '0');
                } else {
                  _queueNumber = queueNumber.toString();
                }

                var strQueueNumber: string = null;

                if (process.env.USE_PRIORITY_PREFIX === 'Y') {
                  strQueueNumber = `${prefixPoint}${prefixPriority} ${_queueNumber}`;
                } else {
                  strQueueNumber = `${prefixPoint} ${_queueNumber}`;
                }

                const dateCreate = moment().format('YYYY-MM-DD HH:mm:ss');

                const qData: any = {};
                qData.servicePointId = servicePointId;
                qData.dateServ = dateServ;
                qData.timeServ = timeServ;
                qData.queueNumber = strQueueNumber;
                qData.hn = hn;
                qData.vn = vn;
                qData.priorityId = priorityId;
                qData.dateCreate = dateCreate;
                qData.hisQueue = hisQueue;
                qData.queueRunning = _queueRunning;
                qData.queueInterview = queueInterview;

                var rsQueue: any = await queueModel.createQueueInfo(db, qData);
                var queueId = rsQueue[0];

                const rs: any = await queueModel.getPrintInfo(db, queueId);

                if (rs[0].length) {
                  const info: any = rs[0][0];
                  const hosname: any = info.hosname;
                  const hosid: any = info.hosid;
                  const queueNumber: any = info.queue_number;

                  const queueWithoutPrefix = +info.queue_running;

                  const servicePointName: any = info.service_point_name;
                  // const remainQueue: any = info.remain_queue || 0;
                  const hn: any = info.hn;
                  const vn: any = info.vn;
                  const priorityName: any = info.priority_name;
                  const dateServ: any = moment(info.date_serv).format('YYYYMMDD');
                  const timeServ: any = moment(info.time_serv, "HH:mm:ss").format('HHmm');
                  // const dateCreated: any = moment(info.date_create).locale('th').format('DD/MM/YYYY HH:mm');
                  const localCode: any = info.local_code;
                  const qrcode = `${hosid}#${process.env.Q4U_NOTIFY_TOKEN}#${hn}#${localCode}#${queueNumber}#${queueWithoutPrefix}#${dateServ}#${timeServ}#${servicePointName}#${priorityName}`;

                  reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.OK, queueId: queueId, hn: hn, vn: vn, queueNumber: queueNumber, qrcode: qrcode });

                  const topic = process.env.QUEUE_CENTER_TOPIC;
                  fastify.mqttClient.publish(topic, 'update visit');

                } else {
                  reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.BAD_REQUEST, message: 'ไม่พบรหัสคิวที่ต้องการ' })
                }

              }

            } else {
              reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ไม่พบรหัสแผนกที่ต้องการ' })
            }
          } else {
            reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.UNAUTHORIZED, message: HttpStatus.getStatusText(HttpStatus.UNAUTHORIZED) })
          }

        } catch (error) {
          fastify.log.error(error);
          reply.status(HttpStatus.UNAUTHORIZED).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: error.message })
        }

      } else {
        reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ข้อมูลไม่ครบ' })
      }
    } else {
      reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ไม่พบ TOKEN' })
    }

  });

  fastify.get('/queue', async (req: fastify.Request, reply: fastify.Reply) => {
    const token = req.query.token;
    const hn = req.query.hn;

    if (token) {
      if (hn) {
        try {
          const rs = await queueModel.getCurrentQueue(db, hn);
          reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.OK, queueNumber: rs[0].queue_number });
        } catch (error) {
          fastify.log.error(error);
          reply.status(HttpStatus.UNAUTHORIZED).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: error.message })
        }

      } else {
        reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ข้อมูลไม่ครบ' })
      }
    } else {
      reply.status(HttpStatus.OK).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'ไม่พบ TOKEN' })
    }
  });
  next();
}

module.exports = router;