import config from 'config';
import { log } from 'server/utils/loggers';

export function getCreatorInfo() {
    const creatorInfo = config.get('creator_info');
    if (creatorInfo === '') {
        log('creator_info_is_empty');
        return null;
    }
    const creatorArr = creatorInfo.split('|');
    if (creatorArr.length === 0) {
        log('creator_info_format_err');
        return null;
    }
    const result = {};
    creatorArr.forEach(creator => {
        const tmp = creator.split(',');
        if (tmp.length !== 2) {
            log('creator_format_err');
            return;
        }
        result[tmp[0]] = tmp[1];
    });
    if (Object.keys(result).length === 0) {
        return null;
    }
    return result;
}
