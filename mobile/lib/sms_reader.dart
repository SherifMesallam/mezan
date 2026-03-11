import 'dart:io';
import 'package:permission_handler/permission_handler.dart';
import 'package:telephony/telephony.dart';

/// Android-only: request READ_SMS and return the body of the most recent inbox SMS.
/// Returns null on iOS, when permission is denied, or when no SMS is found.
Future<String?> getLastInboxSmsBody() async {
  if (!Platform.isAndroid) return null;
  final status = await Permission.sms.request();
  if (!status.isGranted) return null;
  final telephony = Telephony.instance;
  final list = await telephony.getInboxSms(
    columns: [SmsColumn.ADDRESS, SmsColumn.BODY, SmsColumn.DATE],
    sortOrder: [OrderBy(SmsColumn.DATE, sort: Sort.DESC)],
  );
  if (list.isEmpty) return null;
  return list.first.body;
}
