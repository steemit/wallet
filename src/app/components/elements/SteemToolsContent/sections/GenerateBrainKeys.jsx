import React from 'react';
import tt from 'counterpart';
import createHash from 'create-hash';
import { PrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import { FormattedHTMLMessage } from 'app/Translator';
import { STEEM_WORDS } from './steem_words';

class GenerateBrainKeys extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            keysVisible: false,
            brainKey: '',
            editableBrainKey: '',
            privateKey: '',
            publicKey: '',
            error: null,
            success: null,
        };

        this.generateKeys = this.generateKeys.bind(this);
        this.handleEditableBrainKeyChange = this.handleEditableBrainKeyChange.bind(this);
        this.exportKeys = this.exportKeys.bind(this);
        this.buildBrainSequence = this.buildBrainSequence.bind(this);
        this.normalizeBrainKey = this.normalizeBrainKey.bind(this);
        this.sha256 = this.sha256.bind(this);
        this.sha512 = this.sha512.bind(this);
        this.bufferToBigInt = this.bufferToBigInt.bind(this);
        this.getSecureRandomBytes = this.getSecureRandomBytes.bind(this);
        this.derivePrivateKey = this.derivePrivateKey.bind(this);
        this.generateKeyPairFromBrainKey = this.generateKeyPairFromBrainKey.bind(this);
        this.updateKeysFromBrainKey = this.updateKeysFromBrainKey.bind(this);
    }

    componentDidMount() {
        this.generateKeys();
    }

    normalizeBrainKey(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
    }

    sha256(data) {
        return createHash('sha256').update(data).digest();
    }

    sha512(data) {
        return createHash('sha512').update(data).digest();
    }

    bufferToBigInt(bufferLike) {
        const buffer = bufferLike instanceof Uint8Array ? bufferLike : new Uint8Array(bufferLike);
        let hex = '';

        for (let i = 0; i < buffer.length; i += 1) {
            hex += buffer[i].toString(16).padStart(2, '0');
        }

        return hex ? BigInt(`0x${hex}`) : BigInt(0);
    }

    getSecureRandomBytes(length) {
        if (
            typeof window !== 'undefined' &&
            window.crypto &&
            typeof window.crypto.getRandomValues === 'function'
        ) {
            const bytes = new Uint8Array(length);
            window.crypto.getRandomValues(bytes);
            return bytes;
        }

        throw new Error('Secure random generator is not available in this environment');
    }

    buildBrainSequence(wordCount = 16) {
        if (!Array.isArray(STEEM_WORDS) || !STEEM_WORDS.length) {
            throw new Error('STEEM_WORDS is empty or invalid');
        }

        const entropy1 = this.getSecureRandomBytes(32);
        const entropy2 = this.getSecureRandomBytes(32);

        let entropy =
            (this.bufferToBigInt(entropy1) << BigInt(32 * 8)) +
            this.bufferToBigInt(entropy2);

        const wordListSize = BigInt(STEEM_WORDS.length);
        const words = [];

        for (let i = 0; i < wordCount; i += 1) {
            const choice = Number(entropy % wordListSize);
            entropy = entropy / wordListSize;
            words.push(STEEM_WORDS[choice]);
        }

        return this.normalizeBrainKey(words.join(' ')).toUpperCase();
    }

    derivePrivateKey(brainKey, sequence = 0) {
        const normalizedBrainKey = this.normalizeBrainKey(brainKey);

        if (!normalizedBrainKey) {
            throw new Error('Brain key is empty');
        }

        const seed = `${normalizedBrainKey} ${sequence}`;
        const privateKeyBuffer = this.sha256(seed);
        return PrivateKey.fromBuffer(privateKeyBuffer);
    }

    generateKeyPairFromBrainKey(brainKey) {
        const normalizedBrainKey = this.normalizeBrainKey(brainKey);
        const privateKey = this.derivePrivateKey(normalizedBrainKey, 0);
        const wifPrivateKey = privateKey.toWif();
        const publicKey = privateKey.toPublicKey().toString();

        return {
            brainKey: normalizedBrainKey.toUpperCase(),
            privateKey: wifPrivateKey,
            publicKey,
        };
    }

    updateKeysFromBrainKey(rawBrainKey) {
        const normalizedBrainKey = this.normalizeBrainKey(rawBrainKey);

        if (!normalizedBrainKey) {
            this.setState({
                editableBrainKey: rawBrainKey,
                keysVisible: false,
                brainKey: '',
                privateKey: '',
                publicKey: '',
                error: null,
                success: null,
            });
            return;
        }

        try {
            const generatedKeys = this.generateKeyPairFromBrainKey(rawBrainKey);

            this.setState({
                editableBrainKey: rawBrainKey,
                keysVisible: true,
                brainKey: generatedKeys.brainKey,
                privateKey: generatedKeys.privateKey,
                publicKey: generatedKeys.publicKey,
                error: null,
                success: tt('steem_tools.generate_brain_keys.success_message'),
            });
        } catch (e) {
            this.setState({
                editableBrainKey: rawBrainKey,
                keysVisible: false,
                brainKey: '',
                privateKey: '',
                publicKey: '',
                error: tt('steem_tools.generate_brain_keys.error_generating', {
                    message: e && e.message ? e.message : 'Unknown error',
                }),
                success: null,
            });
        }
    }

    handleEditableBrainKeyChange(e) {
        const value = e.target.value;
        this.updateKeysFromBrainKey(value);
    }

    generateKeys() {
        try {
            const generatedBrainKey = this.buildBrainSequence(16);
            const generatedKeys = this.generateKeyPairFromBrainKey(generatedBrainKey);

            this.setState({
                keysVisible: true,
                brainKey: generatedKeys.brainKey,
                editableBrainKey: generatedKeys.brainKey,
                privateKey: generatedKeys.privateKey,
                publicKey: generatedKeys.publicKey,
                error: null,
                success: tt('steem_tools.generate_brain_keys.success_message'),
            });
        } catch (e) {
            this.setState({
                error: tt('steem_tools.generate_brain_keys.error_generating', {
                    message: e && e.message ? e.message : 'Unknown error',
                }),
                success: null,
            });
        }
    }

    exportKeys() {
        const { keysVisible, brainKey, privateKey, publicKey } = this.state;

        if (!keysVisible) return;

        try {
            const payload = {
                brain_priv_key: brainKey.toUpperCase(),
                wif_priv_key: privateKey,
                pub_key: publicKey,
            };

            const file = new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json',
            });

            const element = document.createElement('a');
            element.href = URL.createObjectURL(file);
            element.download = `witness_brain_keys_${Date.now()}.json`;
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);
            URL.revokeObjectURL(element.href);

            this.setState({
                error: null,
                success: tt('steem_tools.generate_brain_keys.export_success_message'),
            });
        } catch (e) {
            this.setState({
                error: tt('steem_tools.generate_brain_keys.error_exporting', {
                    message: e && e.message ? e.message : 'Unknown error',
                }),
                success: null,
            });
        }
    }

    render() {
        const {
            keysVisible,
            brainKey,
            editableBrainKey,
            privateKey,
            publicKey,
            error,
            success,
        } = this.state;

        const keyRows = [
            {
                key: 'brain',
                type: tt('steem_tools.generate_brain_keys.brain_sequence_label'),
                value: brainKey,
            },
            {
                key: 'private',
                type: tt('steem_tools.generate_brain_keys.private_key_label'),
                value: privateKey,
            },
            {
                key: 'public',
                type: tt('steem_tools.generate_brain_keys.public_key_label'),
                value: publicKey,
            },
        ];

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">
                            {tt('steem_tools.generate_brain_keys.panel_title')}
                        </h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.generate_brain_keys.description"
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                            <div className="column small-12">
                                <div
                                    className="change-recovery-account-hint"
                                    style={{ marginBottom: '0.5rem' }}
                                >
                                    {tt('steem_tools.generate_brain_keys.brain_sequence_label')}
                                </div>

                                <textarea
                                    className="bold"
                                    value={editableBrainKey}
                                    onChange={this.handleEditableBrainKeyChange}
                                    placeholder="ANCHOR AUTUMN BANNER ..."
                                    rows={2}
                                    spellCheck={false}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        minHeight: '5.25rem',
                                        padding: '0.75rem',
                                        lineHeight: '1.5',
                                        resize: 'vertical',
                                        overflowY: 'auto',
                                        overflowX: 'hidden',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'anywhere',
                                        boxSizing: 'border-box',
                                    }}
                                />

                                <div
                                    className="change-recovery-account-hint"
                                    style={{ marginTop: '0.35rem' }}
                                >
                                    Edit the words and the keys will be regenerated automatically from that exact phrase.
                                </div>
                            </div>
                        </div>

                        {keysVisible ? (
                            <div className="row">
                                <div className="column small-12">
                                    <div className="KeyGenerationTableWrapper">
                                        <table className="KeyGenerationTable">
                                            <thead>
                                                <tr>
                                                    <th>
                                                        {tt('steem_tools.generate_brain_keys.key_type_header')}
                                                    </th>
                                                    <th>
                                                        {tt('steem_tools.generate_brain_keys.key_value_header')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {keyRows.map((row) => (
                                                    <tr key={row.key}>
                                                        <td className="key-type-cell">
                                                            {row.type}
                                                        </td>
                                                        <td className="key-value-cell">
                                                            {row.value}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">{error}</div>
                                </div>
                            </div>
                        ) : null}

                        {success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">
                                        {success}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row">
                            <div className="column">
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.generateKeys}
                                >
                                    {tt('steem_tools.generate_brain_keys.generate_btn')}
                                </button>
                                &nbsp;&nbsp;&nbsp;
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.exportKeys}
                                    disabled={!keysVisible}
                                >
                                    {tt('steem_tools.generate_brain_keys.export_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default GenerateBrainKeys;
