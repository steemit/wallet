import React from 'react';
import tt from 'counterpart';
import { PrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import PdfDownload from 'app/components/elements/PdfDownload';
import { FormattedHTMLMessage } from 'app/Translator';

class KeyGeneration extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            username: '',
            masterPassword: '',
            keysVisible: false,
            keys: {
                active: { private: '', public: '' },
                posting: { private: '', public: '' },
                owner: { private: '', public: '' },
                memo: { private: '', public: '' },
            },
            error: null,
            success: null,
            dlPdf: false,
        };

        this.onChange = this.onChange.bind(this);
        this.generateRandomPassword = this.generateRandomPassword.bind(this);
        this.generateKeys = this.generateKeys.bind(this);
        this.exportKeys = this.exportKeys.bind(this);
        this.exportPdf = this.exportPdf.bind(this);
        this.resetDlPdf = this.resetDlPdf.bind(this);
    }

    onChange(e) {
        const name = e.target.name;
        let value = e.target.value;

        if (name === 'username' || name === 'masterPassword') {
            value = value.replace(/\s/g, '');
        }
        if (name === 'username') {
            value = value.toLowerCase();
        }

        this.setState({
            [name]: value,
            error: null,
            success: null,
        });
    }

    generateRandomPassword() {
        var randomSeed = Date.now() + '-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
        var privateKey = PrivateKey.fromSeed(randomSeed).toWif();
        var generatedWif = 'P' + privateKey;
        this.setState({ masterPassword: generatedWif, error: null, success: null });
    }

    generateKeys() {
        let { username, masterPassword } = this.state;
        if (!username) {
            this.setState({ error: tt('steem_tools.key_generation.error_no_account'), success: null });
            return;
        }

        let generatedPassword = masterPassword;
        if (!generatedPassword) {
            var randomSeed = Date.now() + '-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
            generatedPassword = 'P' + PrivateKey.fromSeed(randomSeed).toWif();
        }

        try {
            const roles = ['active', 'posting', 'owner', 'memo'];
            let newKeys = {};
            roles.forEach((role) => {
                const pk = PrivateKey.fromSeed(`${username}${role}${generatedPassword}`);
                newKeys[role] = {
                    private: pk.toWif(),
                    public: pk.toPublicKey().toString(),
                };
            });

            this.setState({
                masterPassword: generatedPassword,
                keysVisible: true,
                keys: newKeys,
                error: null,
                success: tt('steem_tools.key_generation.success_message'),
            });
        } catch (e) {
            this.setState({ error: tt('steem_tools.key_generation.error_generating', { message: e.message }), success: null });
        }
    }

    exportKeys() {
        if (!this.state.keysVisible) return;
        const { username, masterPassword, keys } = this.state;
        let content = `Account: ${username}\nMaster Password: ${masterPassword}\n\n`;
        const roles = ['active', 'posting', 'owner', 'memo'];
        roles.forEach((role) => {
            content += `${role.toUpperCase()} KEYS\n`;
            content += `Private: ${keys[role].private}\n`;
            content += `Public: ${keys[role].public}\n\n`;
        });

        const element = document.createElement("a");
        const file = new Blob([content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = `${username}_steem_keys.txt`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    exportPdf() {
        if (!this.state.keysVisible) return;
        this.setState({ dlPdf: true });
    }

    resetDlPdf() {
        this.setState({ dlPdf: false });
    }

    render() {
        let error = this.state.error;
        let success = this.state.success;



        const roles = ['active', 'posting', 'owner', 'memo'];
        const keyRows = roles.flatMap((role, groupIndex) => [
            {
                role,
                rowKind: 'private',
                groupIndex,
                type: tt('steem_tools.key_generation.private_key', {
                    role: role.charAt(0).toUpperCase() + role.slice(1),
                }),
                value: this.state.keys[role].private,
            },
            {
                role,
                rowKind: 'public',
                groupIndex,
                type: tt('steem_tools.key_generation.public_key', {
                    role: role.charAt(0).toUpperCase() + role.slice(1),
                }),
                value: this.state.keys[role].public,
            },
        ]);

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.key_generation.panel_title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.key_generation.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile">
                            <div className="column flex-container-1-extended flex-mobile-full" style={{ paddingTop: 5 }}>
                                <div className="label-with-tooltip">
                                    <div>{tt('steem_tools.key_generation.account_label')}</div>
                                </div>
                            </div>

                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        className="input-group-field bold"
                                        type="text"
                                        name="username"
                                        value={this.state.username}
                                        onChange={this.onChange}
                                        placeholder={tt('steem_tools.key_generation.account_placeholder')}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div className="column flex-container-1-extended flex-mobile-full" style={{ paddingTop: 5 }}>
                                <div className="label-with-tooltip">
                                    <div>{tt('steem_tools.key_generation.master_password_label')}</div>
                                </div>
                            </div>

                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                                    <input
                                        className="input-group-field bold flex-mobile-full"
                                        type="text"
                                        name="masterPassword"
                                        value={this.state.masterPassword}
                                        onChange={this.onChange}
                                        autoComplete="off"
                                        placeholder={tt('steem_tools.key_generation.master_password_placeholder')}
                                    />
                                    <div className="input-group-button flex-mobile-full">
                                        <button className="button" id="generate-button" type="button" onClick={this.generateRandomPassword}>
                                            {tt('steem_tools.key_generation.generate_btn')}
                                        </button>
                                    </div>
                                </div>
                                <div style={{ marginTop: -10, fontSize: 12, opacity: 0.8, marginBottom: '1.25rem' }}>
                                    {tt('steem_tools.key_generation.master_password_hint')}
                                </div>
                            </div>
                        </div>

                        {this.state.keysVisible && (
                            <div className="row">
                                <h3 className="column">{tt('steem_tools.key_generation.generated_keys_title')}</h3>
                            </div>
                        )}

                        {this.state.keysVisible && (
                            <div className="row">
                                <div className="column small-12">
                                    <div className="KeyGenerationTableWrapper">
                                        <table className="KeyGenerationTable">
                                            <thead>
                                                <tr>
                                                    <th>{tt('steem_tools.key_generation.key_type_header')}</th>
                                                    <th>{tt('steem_tools.key_generation.key_value_header')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {keyRows.map((row) => (
                                                    <tr
                                                        key={`${row.role}-${row.rowKind}`}
                                                        className={row.groupIndex % 2 === 0 ? 'role-group-even' : 'role-group-odd'}
                                                    >
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
                        )}

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
                                    <div className="advtools-message-success">{success}</div>
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
                                    {tt('steem_tools.key_generation.generate_keys_btn')}
                                </button>
                                &nbsp;&nbsp;&nbsp;
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.exportKeys}
                                    disabled={!this.state.keysVisible}
                                >
                                    {tt('steem_tools.key_generation.export_txt_btn')}
                                </button>
                                &nbsp;&nbsp;&nbsp;
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.exportPdf}
                                    disabled={!this.state.keysVisible}
                                >
                                    {tt('steem_tools.key_generation.export_pdf_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {this.state.keysVisible && (
                    <PdfDownload
                        widthInches={8.5}
                        name={this.state.username}
                        password={this.state.masterPassword}
                        keys={{
                            postingPrivate: this.state.keys.posting.private,
                            postingPublic: this.state.keys.posting.public,
                            activePrivate: this.state.keys.active.private,
                            activePublic: this.state.keys.active.public,
                            ownerPrivate: this.state.keys.owner.private,
                            ownerPublic: this.state.keys.owner.public,
                            memoPrivate: this.state.keys.memo.private,
                            memoPublic: this.state.keys.memo.public,
                            master: this.state.masterPassword,
                        }}
                        dlPdf={this.state.dlPdf}
                        resetDlPdf={this.resetDlPdf}
                    />
                )}
            </div>
        );
    }
}

export default KeyGeneration;
