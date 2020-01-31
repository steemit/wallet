import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import * as appActions from 'app/redux/AppReducer';
import o2j from 'shared/clash/object2json';

class Settings extends React.Component {
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
