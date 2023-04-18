import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import * as appActions from 'app/redux/AppReducer';
import * as steem from '@steemit/steem-js';

class Settings extends React.Component {
    constructor(props) {
        super();

        this.rpcNode =
            (props.user_preferences && props.user_preferences.selectedRpc) ||
            $STM_Config.steemd_connection_client;
    }

    validateUrlFormat(url) {
        if (!url) return false;
        if (!/^https?:\/\//.test(url)) return false;
        return true;
    }

    handleSelectRPCNode = event => {
        const selectedUrl = event.target.value;

        if (this.validateUrlFormat(selectedUrl) === false) {
            this.setState({
                rpcError: tt('settings_jsx.invalid_url'),
            });
            return;
        }

        this.props.setUserPreferences({
            ...this.props.user_preferences,
            selectedRpc: selectedUrl,
        });

        // Store RPC Node in localStorage
        localStorage.setItem('steemSelectedRpc', selectedUrl);

        // Set at the same time as selection
        steem.api.setOptions({
            url: selectedUrl,
        });
    };

    handleLanguageChange = event => {
        const locale = event.target.value;
        const userPreferences = { ...this.props.user_preferences, locale };
        this.props.setUserPreferences(userPreferences);
    };

    render() {
        const { user_preferences } = this.props;
        return (
            <div className="Settings">
                <div className="row">
                    <div className="small-12 medium-4 large-4 columns">
                        <br />
                        <br />
                        <h4>{tt('settings_jsx.rpc_title')}</h4>

                        <label>
                            {tt('settings_jsx.rpc_select')} {this.rpcNode}
                        </label>
                        <select
                            defaultValue={this.rpcNode}
                            onChange={this.handleSelectRPCNode}
                        >
                            {$STM_Config.steemd_rpc_list.map(rpc => (
                                <option key={rpc} value={rpc}>
                                    {rpc}
                                </option>
                            ))}
                        </select>
                        <label>
                            {tt('settings_jsx.selected_rpc', {
                                rpc:
                                    this.props.user_preferences.selectedRpc ||
                                    this.rpcNode,
                            })}
                        </label>
                        <br />
                        <br />
                    </div>
                </div>
                <div className="row">
                    <div className="small-12 medium-6 large-4 columns">
                        <h4>{tt('settings_jsx.preferences')}</h4>
                        {tt('g.choose_language')}
                        <select
                            defaultValue={user_preferences.locale}
                            onChange={this.handleLanguageChange}
                        >
                            <option value="en">English</option>
                            <option value="es">Spanish Español</option>
                            <option value="ru">Russian русский</option>
                            <option value="fr">French français</option>
                            <option value="it">Italian italiano</option>
                            <option value="ko">Korean 한국어</option>
                            <option value="ja">Japanese 日本語</option>
                            <option value="pl">Polish</option>
                            <option value="zh">Chinese 简体中文</option>
                        </select>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const user_preferences = state.app.get('user_preferences').toJS();
        return {
            user_preferences,
            ...ownProps,
        };
    },
    // mapDispatchToProps
    dispatch => ({
        setUserPreferences: payload => {
            dispatch(appActions.setUserPreferences(payload));
        },
    })
)(Settings);
