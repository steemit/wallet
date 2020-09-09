/* eslint-disable no-undef */
import { signData, authData } from 'server/utils/encrypted';

/**
 * Private Key: 5J5MXVUyJwXWG6VQaBj1uimiMSGM1ky1HWYrZkaGpBrazbFmE2f
 * Public Key: STM76hoMV1XezMjEMhdA9EyXz4aY1JmbXUfA2mRRGUYmgbEmgDMCG
 * Private Key: 5KSym4fDweNBkKzwf2CuPun4J97o5mhEABfuAEgBp9wL6AKWG6Y
 * Public Key: STM74ujL6hgg6d2GcBAftyszFNbyf1rUuEaSmbcHyTuUXpghGzomo
 */

describe('Server utils misc', () => {
    it('test signData unexpected private key', () => {
        try {
            signData('test', 'private_key');
        } catch (error) {
            expect(error.message).toEqual('unexpected_private_key');
        }
    });
    it('test authData lost nonce', () => {
        try {
            const data = {};
            authData(data, 'public_key');
        } catch (error) {
            expect(error.message).toEqual('lost_nonce');
        }
    });
    it('test authData lost timestamp', () => {
        try {
            const data = {
                nonce: '123412',
            };
            authData(data, 'public_key');
        } catch (error) {
            expect(error.message).toEqual('lost_timestamp');
        }
    });
    it('test authData lost signature', () => {
        try {
            const data = {
                nonce: '123412',
                timestamp: '1597107500',
            };
            authData(data, 'public_key');
        } catch (error) {
            expect(error.message).toEqual('lost_signature');
        }
    });
    // it('test authData data timeout', () => {
    //     try {
    //         const data = {
    //             nonce: '123412',
    //             timestamp: '1597107500',
    //             signature: '12341241',
    //         };
    //         authData(data, 'public_key');
    //     } catch (error) {
    //         expect(error.message).toEqual('data_timeout');
    //     }
    // });
    it('test signData and authData', () => {
        const data = {
            username: 'tron_reward',
            tron_addr: 'abcdefgh',
        };
        const signedData = signData(
            data,
            '5J5MXVUyJwXWG6VQaBj1uimiMSGM1ky1HWYrZkaGpBrazbFmE2f'
        );
        const r = authData(
            signedData,
            'STM76hoMV1XezMjEMhdA9EyXz4aY1JmbXUfA2mRRGUYmgbEmgDMCG'
        );
        expect(r).toEqual(true);
        const r1 = authData(
            signedData,
            'STM74ujL6hgg6d2GcBAftyszFNbyf1rUuEaSmbcHyTuUXpghGzomo'
        );
        expect(r1).toEqual(false);
    });
});
